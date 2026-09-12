require('dotenv').config();

const messages = [
  { role: 'user', parts: [{ text: 'Here is some code and its review. Use this as context.' }] },
  { role: 'model', parts: [{ text: 'Got it! Feel free to ask me anything.' }] },
  { role: 'user', parts: [{ text: 'explain' }] }
];

fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ contents: messages })
})
  .then(r => r.json())
  .then(data => console.log(JSON.stringify(data, null, 2)))
  .catch(err => console.log('Error:', err));