/**
 * One-shot helper to generate a Gmail refresh token using OAuth 2.0.
 *
 * Usage:
 *   1. In Google Cloud Console, create an OAuth 2.0 Client ID (type: "Web application").
 *      Add `http://localhost:3000/oauth2callback` as an authorised redirect URI.
 *   2. Enable the Gmail API for the project.
 *   3. Export the credentials:
 *        GOOGLE_CLIENT_ID=...  GOOGLE_CLIENT_SECRET=...  npm run oauth:setup
 *   4. Follow the printed URL, consent, and the refresh token is printed to stdout.
 *   5. Paste the refresh token into Vercel env as GOOGLE_REFRESH_TOKEN.
 */
import { google } from 'googleapis';
import http from 'node:http';
import { URL } from 'node:url';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT = 'http://localhost:3000/oauth2callback';
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars.');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT);
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES,
});

console.log('\n1. Open this URL in a browser and consent:\n');
console.log(authUrl);
console.log('\n2. After consent you will be redirected to localhost:3000 — leave this script running until then.\n');

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return;
    const u = new URL(req.url, REDIRECT);
    const code = u.searchParams.get('code');
    if (!code) {
      res.writeHead(400).end('Missing code');
      return;
    }
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Done — return to terminal.');
    console.log('\n✓ Refresh token:\n');
    console.log(tokens.refresh_token);
    console.log('\nAdd this to Vercel env as GOOGLE_REFRESH_TOKEN.\n');
    server.close();
  } catch (err) {
    console.error(err);
    res.writeHead(500).end('Error');
  }
});

server.listen(3000, () => console.log('Listening on http://localhost:3000 for callback...'));
