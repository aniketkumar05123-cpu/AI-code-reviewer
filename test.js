require('dotenv').config();

fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'Say hello' }] }]
  })
})
  .then(r => r.json())
  .then(data => console.log(JSON.stringify(data, null, 2)))
  .catch(err => console.log('Error:', err));