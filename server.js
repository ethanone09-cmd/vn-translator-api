const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())

function fakeTranslateZhToVi(text) {
  const dict = {
    '你好': 'Xin chào',
    '你好，今天晚上你有空吗？': 'Xin chào, tối nay bạn có rảnh không?',
    '今天晚上你有空吗？': 'Tối nay bạn có rảnh không?',
    '我现在在测试翻译功能': 'Tôi đang kiểm tra chức năng dịch',
    '请稍等一下': 'Vui lòng chờ một chút',
    '谢谢': 'Cảm ơn',
    '我要去吃饭': 'Tôi đi ăn đây',
    '今天天气很好': 'Hôm nay thời tiết rất đẹp',
    '可以开始了吗？': 'Có thể bắt đầu được chưa?',
    '这个翻译插件已经安装成功': 'Plugin dịch này đã được cài đặt thành công'
  }

  const clean = (text || '').trim()
  return dict[clean] || `【API演示翻译】${clean} → bản dịch tiếng Việt`
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    message: 'VN Translator API is running'
  })
})

app.post('/translate', (req, res) => {
  const text = req.body?.text || ''

  if (!text.trim()) {
    return res.status(400).json({
      ok: false,
      error: 'text is required'
    })
  }

  const translatedText = fakeTranslateZhToVi(text)

  res.json({
    ok: true,
    sourceText: text,
    translatedText
  })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})