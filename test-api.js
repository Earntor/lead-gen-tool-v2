fetch('http://localhost:3000/api/lead', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    ip_address: '8.8.8.8',
    user_id: '00000000-0000-0000-0000-000000000000',
    page_url: '/test-page-' + Date.now()
  })
})
