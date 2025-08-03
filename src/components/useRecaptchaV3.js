// lib/useRecaptchaV3.js
export const executeRecaptcha = async (siteKey, action = 'login') => {
  return new Promise((resolve, reject) => {
    if (!window.grecaptcha) return reject('⚠️ grecaptcha niet beschikbaar')
    window.grecaptcha.ready(() => {
      window.grecaptcha.execute(siteKey, { action }).then(resolve).catch(reject)
    })
  })
}
