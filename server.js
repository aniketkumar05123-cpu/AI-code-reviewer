

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/user');
const auth = require('./middleware/auth');
const Review = require('./models/Review');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.log('MongoDB Connection error', err));

app.get('/', (req, res) => {
  res.send('AI Code Reviewer backend is running!');
});

app.post('/review', auth, async (req, res) => {
  try {
    const code = req.body.code;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Review this code and give feedback:\n\n${code}` }] }]
        })
      }
    );

    const data = await response.json();
    console.log('Gemini response:', JSON.stringify(data, null, 2));
    const feedbackText = data.candidates[0].content.parts[0].text;

    const newReview = new Review({
      userId: req.userId,
      code: code,
      feedback: feedbackText
    });

    await newReview.save();
    console.log('Review saved successfully for user:', req.userId);

    res.json(data);
  } catch (err) {
    console.log('Review route error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.post('/chat', auth, async (req, res) => {
  try {
    const messages = req.body.messages;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: messages })
      }
    );

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.log('Chat route error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.post('/signup', async (req, res) => {
  const { email, password } = req.body;

  try {
    const existingUser = await User.findOne({ email: email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ email: email, password: hashedPassword });
    await newUser.save();

    res.json({ message: 'User created successfully!' });
  } catch (err) {
    console.log('Signup error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email });
  if (!user) {
    return res.status(400).json({ error: 'User not found' });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(400).json({ error: 'Incorrect password' });
  }

  const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token: token });
});

app.get('/history', auth, async (req, res) => {
  const reviews = await Review.find({ userId: req.userId }).sort({ createdAt: -1 });
  res.json(reviews);
});

app.get('/auth/github', (req, res) => {
  const token = req.query.token;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&scope=repo&state=${decoded.userId}`;
  res.redirect(githubAuthUrl);
});

app.get('/auth/github/callback', async (req, res) => {
  const code = req.query.code;
  const userId = req.query.state;

  console.log('GitHub callback received for userId:', userId);
  console.log('typeof userId:', typeof userId, userId);

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code: code
    })
  });

  const tokenData = await tokenResponse.json();
  console.log('Token data received from GitHub:', tokenData);

  const updateResult = await User.findByIdAndUpdate(
    userId,
    { githubToken: tokenData.access_token },
    { new: true }
  );

  console.log('Update result:', updateResult);

  res.send('GitHub connected successfully! You can now close this tab.');
});
app.get('/github/repos', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);

    if (!user.githubToken) {
      return res.status(400).json({ error: 'GitHub not connected' });
    }

    const response = await fetch('https://api.github.com/user/repos', {
      headers: {
        'Authorization': `Bearer ${user.githubToken}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    const repos = await response.json();
    res.json(repos);
  } catch (err) {
    console.log('GitHub repos error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});
app.get('/github/repos/:owner/:repo/pulls', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);

    if (!user.githubToken) {
      return res.status(400).json({ error: 'GitHub not connected' });
    }
    const { owner, repo } = req.params;
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open`, {
      headers: {
        'Authorization': `Bearer ${user.githubToken}`,
        'Accept': 'application/vnd.github+json'
      }
    });
    const pulls = await response.json();
    if (!response.ok) {
      return res.status(response.status).json( pulls);
    }res.json(pulls);
  } catch (err) {
    console.log('GitHub pulls error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});
/* =========================================================
   AI PULL REQUEST REVIEW
========================================================= */

app.post(
  '/github/repos/:owner/:repo/pulls/:pullNumber/review',
  auth,
  async (req, res) => {

    try {

      const user =
        await User.findById(req.userId);

      if (!user.githubToken) {

        return res.status(400).json({
          error: 'GitHub not connected'
        });

      }

      const {
        owner,
        repo,
        pullNumber
      } = req.params;


      /* ---------------------------------------------------
         GET CHANGED FILES FROM GITHUB
      --------------------------------------------------- */

      const filesResponse =
        await fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/files`,
          {
            headers: {
              'Authorization':
                `Bearer ${user.githubToken}`,

              'Accept':
                'application/vnd.github+json'
            }
          }
        );


      const files =
        await filesResponse.json();


      if (!filesResponse.ok) {

        return res.status(
          filesResponse.status
        ).json(files);

      }


      if (
        !Array.isArray(files) ||
        files.length === 0
      ) {

        return res.status(400).json({

          error:
            'No changed files found in this pull request.'

        });

      }


      /* ---------------------------------------------------
         BUILD DIFF FOR AI
      --------------------------------------------------- */

      let diffText = '';


      files.forEach(file => {

        diffText += `

==================================================
FILE: ${file.filename}
STATUS: ${file.status}
ADDITIONS: ${file.additions}
DELETIONS: ${file.deletions}
==================================================

${file.patch || 'No patch available for this file.'}

`;

      });


      /* ---------------------------------------------------
         ASK GEMINI TO REVIEW THE PR
      --------------------------------------------------- */

      const prompt = `

You are an expert senior software engineer performing
a Pull Request code review.

Review the following GitHub Pull Request changes.

Focus on:

1. Bugs and correctness issues
2. Security vulnerabilities
3. Performance problems
4. Code quality
5. Maintainability
6. Error handling
7. Potential breaking changes

Only report meaningful issues.

For every issue, explain:

- Severity
- File
- Problem
- Why it matters
- Recommended fix

Also provide:

- Overall PR assessment
- What was done well
- Most important improvements
- Final recommendation

Here are the changed files:

${diffText}

`;


      const aiResponse =
        await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body: JSON.stringify({

              contents: [

                {
                  parts: [
                    {
                      text: prompt
                    }
                  ]
                }

              ]

            })

          }
        );


      const aiData =
        await aiResponse.json();


      if (!aiResponse.ok) {

        console.log(
          'Gemini PR review error:',
          aiData
        );

        return res.status(
          aiResponse.status
        ).json({

          error:
            'AI review failed.'

        });

      }


      const feedbackText =
        aiData
          ?.candidates?.[0]
          ?.content?.parts?.[0]
          ?.text;


      if (!feedbackText) {

        return res.status(500).json({

          error:
            'AI returned an empty PR review.'

        });

      }


      /* ---------------------------------------------------
         SAVE PR REVIEW TO HISTORY
      --------------------------------------------------- */

      const newReview =
        new Review({

          userId:
            req.userId,

          code:
            `Pull Request #${pullNumber}\n\n${diffText}`,

          feedback:
            feedbackText

        });


      await newReview.save();


      console.log(
        'PR review saved successfully for user:',
        req.userId
      );


      /* ---------------------------------------------------
         SEND RESULT TO FRONTEND
      --------------------------------------------------- */

      res.json({

        pullNumber:
          Number(pullNumber),

        owner,

        repo,

        filesReviewed:
          files.length,

        review:
          feedbackText

      });


    } catch (err) {

      console.log(
        'AI Pull Request review error:',
        err
      );

      res.status(500).json({

        error:
          'Something went wrong while reviewing the pull request.'

      });

    }

  }
);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});