export default async function handler(req, res) {
  const { token } = JSON.parse(req.body);
  const secret = process.env.RECAPTCHA_SECRET_KEY;

  const response = await fetch(`https://www.google.com/recaptcha/api/siteverify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${secret}&response=${token}`
  });

  const data = await response.json();
  res.status(200).json(data);
}
