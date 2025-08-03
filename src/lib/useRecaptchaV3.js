export async function executeRecaptcha(siteKey) {
  return new Promise((resolve, reject) => {
    if (!window.grecaptcha || !window.grecaptcha.execute) {
      return reject(new Error('reCAPTCHA niet geladen'))
    }

    window.grecaptcha.ready(() => {
      window.grecaptcha.execute(siteKey, { action: 'login' })
        .then(resolve)
        .catch(reject)
    })
  })
}
