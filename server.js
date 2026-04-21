require('dotenv').config()

const express = require('express')
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')
const os = require('os')
const cors = require('cors')
const { OpenAI } = require('openai')

const app = express()

app.use(cors())
app.use(express.json({ limit: '2mb' }))

const PORT = Number(process.env.PORT || 3000)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env')
  process.exit(1)
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY })

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    message: 'VN translator API is running',
  })
})

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    port: PORT,
    hasKey: Boolean(OPENAI_API_KEY),
    time: new Date().toISOString(),
  })
})

app.post('/translate', async (req, res) => {
  try {
    console.log('[HTTP] /translate called:', req.body)

    const text = String(req.body?.text || '').trim()
    const source = String(req.body?.source || 'zh')
    const target = String(req.body?.target || 'vi')

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: 'text is required',
      })
    }

    const prompt = `Translate the following text from ${source} to ${target}. Return only the translated text.\n\n${text}`

    const resp = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: prompt,
    })

    const translatedText = String(resp.output_text || '').trim()

    res.json({
      ok: true,
      translatedText: translatedText || text,
    })
  } catch (error) {
    console.error('[HTTP] /translate error:', error)
    res.status(500).json({
      ok: false,
      error: error?.message || 'translate failed',
    })
  }
})

const server = http.createServer(app)

const wss = new WebSocket.Server({
  server,
  path: '/audio-stream',
})

function sendJson(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj))
  }
}

function pcm16ToWavBuffer(
  pcmBuffer,
  sampleRate = 16000,
  channels = 1,
  bitsPerSample = 16
) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8
  const blockAlign = (channels * bitsPerSample) / 8
  const dataSize = pcmBuffer.length
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  pcmBuffer.copy(buffer, 44)
  return buffer
}

async function buildReplyMeaningAndPronunciation(recognizedText, translatedText) {
  if (!recognizedText && !translatedText) {
    return {
      autoReply: '',
      meaningText: '',
      pronunciationText: '',
    }
  }

  const enrichPrompt = `
You are helping build live smart-glasses translation output.

Input Chinese:
${recognizedText}

Vietnamese translation:
${translatedText}

Return JSON only with exactly this schema:
{
  "autoReply": "...",
  "meaningText": "...",
  "pronunciationText": "..."
}

Rules:
- autoReply: one short and natural Vietnamese reply suitable for the conversation context.
- meaningText: one short Chinese explanation / Chinese meaning of the Vietnamese sentence.
- pronunciationText: one short Chinese pronunciation aid for the Vietnamese sentence, using simple Chinese characters to approximately represent the Vietnamese pronunciation.
- All three fields must be concise and suitable for a small HUD display.
- Do not include markdown.
- Do not include any extra keys.
- Return valid JSON only.
`

  const enrichResp = await openai.responses.create({
    model: 'gpt-4.1-mini',
    input: enrichPrompt,
  })

  const raw = String(enrichResp.output_text || '').trim()

  try {
    const parsed = JSON.parse(raw)
    return {
      autoReply: String(parsed.autoReply || '').trim(),
      meaningText: String(parsed.meaningText || '').trim(),
      pronunciationText: String(parsed.pronunciationText || '').trim(),
    }
  } catch (error) {
    console.error('[ENRICH] parse error:', error)
    console.error('[ENRICH] raw output:', raw)
    return {
      autoReply: '',
      meaningText: '',
      pronunciationText: '',
    }
  }
}

async function transcribeAndTranslateFromWav(wavPath) {
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(wavPath),
    model: 'gpt-4o-mini-transcribe',
    language: 'zh',
  })

  const recognizedText = String(transcription.text || '').trim()

  if (!recognizedText) {
    return {
      recognizedText: '',
      translatedText: '',
      autoReply: '',
      meaningText: '',
      pronunciationText: '',
    }
  }

  const translationPrompt = `Translate the following Chinese text into natural Vietnamese. Return only the Vietnamese translation.\n\n${recognizedText}`

  const translationResp = await openai.responses.create({
    model: 'gpt-4.1-mini',
    input: translationPrompt,
  })

  const translatedText = String(translationResp.output_text || '').trim()

  const {
    autoReply,
    meaningText,
    pronunciationText,
  } = await buildReplyMeaningAndPronunciation(recognizedText, translatedText)

  return {
    recognizedText,
    translatedText,
    autoReply,
    meaningText,
    pronunciationText,
  }
}

wss.on('connection', (ws, req) => {
  console.log(`[WS] connected from ${req.socket.remoteAddress}`)

  const session = {
    sessionId: '',
    format: 'pcm_s16le',
    sampleRate: 16000,
    channels: 1,
    source: 'zh',
    target: 'vi',
    chunks: [],
    chunkCount: 0,
    totalBytes: 0,
    startedAt: Date.now(),
    stopped: false,
    finalized: false,
  }

  ws.on('message', async (message, isBinary) => {
    try {
      if (!isBinary) {
        const text = message.toString()
        const data = JSON.parse(text)

        if (data.type === 'start') {
          session.sessionId = data.sessionId || `g2-${Date.now()}`
          session.format = data.format || 'pcm_s16le'
          session.sampleRate = Number(data.sampleRate || 16000)
          session.channels = Number(data.channels || 1)
          session.source = data.source || 'zh'
          session.target = data.target || 'vi'
          session.startedAt = Date.now()
          session.stopped = false
          session.finalized = false
          session.chunks = []
          session.chunkCount = 0
          session.totalBytes = 0

          console.log(
            `[WS] start session=${session.sessionId} format=${session.format} sampleRate=${session.sampleRate} channels=${session.channels}`
          )

          sendJson(ws, {
            type: 'status',
            message: 'recording started',
          })
          return
        }

        if (data.type === 'stop') {
          if (session.finalized) return

          session.stopped = true
          session.finalized = true

          const durationMs = Date.now() - session.startedAt

          console.log(
            `[WS] stop session=${session.sessionId} chunks=${session.chunkCount} bytes=${session.totalBytes} durationMs=${durationMs}`
          )

          sendJson(ws, {
            type: 'status',
            message: `processing ${session.chunkCount} chunks / ${session.totalBytes} bytes`,
          })

          if (!session.totalBytes) {
            sendJson(ws, {
              type: 'error',
              message: 'no audio received',
            })
            return
          }

          const pcmBuffer = Buffer.concat(session.chunks)
          const wavBuffer = pcm16ToWavBuffer(
            pcmBuffer,
            session.sampleRate,
            session.channels,
            16
          )

          const tempWavPath = path.join(
            os.tmpdir(),
            `${session.sessionId || 'audio'}-${Date.now()}.wav`
          )

          fs.writeFileSync(tempWavPath, wavBuffer)

          try {
            const {
              recognizedText,
              translatedText,
              autoReply,
              meaningText,
              pronunciationText,
            } = await transcribeAndTranslateFromWav(tempWavPath)

            console.log(
              `[WS] final_result session=${session.sessionId} recognized="${recognizedText}" translated="${translatedText}" autoReply="${autoReply}" meaning="${meaningText}" pronunciation="${pronunciationText}"`
            )

            sendJson(ws, {
              type: 'final_result',
              recognizedText: recognizedText || '',
              translatedText: translatedText || '',
              autoReply: autoReply || '',
              meaningText: meaningText || '',
              pronunciationText: pronunciationText || '',
            })
          } catch (error) {
            console.error('[WS] ASR/translate error:', error)
            sendJson(ws, {
              type: 'error',
              message: error?.message || 'ASR/translate failed',
            })
          } finally {
            try {
              fs.unlinkSync(tempWavPath)
            } catch (_) {}
          }

          return
        }

        console.log('[WS] unknown text message:', data)
        return
      }

      const chunk = Buffer.from(message)
      session.chunks.push(chunk)
      session.chunkCount += 1
      session.totalBytes += chunk.length

      if (session.chunkCount % 10 === 0) {
        console.log(
          `[WS] session=${session.sessionId} chunk=${session.chunkCount} totalBytes=${session.totalBytes}`
        )

        sendJson(ws, {
          type: 'status',
          message: `received ${session.chunkCount} chunks / ${session.totalBytes} bytes`,
        })

        sendJson(ws, {
          type: 'partial_text',
          text: `已收到 ${session.chunkCount} 包音频`,
        })
      }
    } catch (error) {
      console.error('[WS] message error:', error)
      sendJson(ws, {
        type: 'error',
        message: error?.message || 'message handling failed',
      })
    }
  })

  ws.on('close', () => {
    console.log(
      `[WS] closed session=${session.sessionId} chunks=${session.chunkCount} bytes=${session.totalBytes}`
    )
  })

  ws.on('error', (error) => {
    console.error('[WS] socket error:', error)
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP server running on http://0.0.0.0:${PORT}`)
  console.log(`WebSocket server running on ws://0.0.0.0:${PORT}/audio-stream`)
})