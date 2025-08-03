// components/RecaptchaClient.js
import { useRef, forwardRef, useImperativeHandle, useState } from 'react'
import ReCAPTCHA from 'react-google-recaptcha'

const RecaptchaClient = forwardRef(({ sitekey, badge = 'bottomright', onErrored }, ref) => {
  const internalRef = useRef(null)
  const [ready, setReady] = useState(false)

  useImperativeHandle(ref, () => ({
    async executeAsync() {
      if (ready && internalRef.current?.executeAsync) {
        return await internalRef.current.executeAsync()
      }
      throw new Error('reCAPTCHA nog niet klaar')
    },
    reset() {
      internalRef.current?.reset?.()
    },
  }))

  return (
    <ReCAPTCHA
      ref={internalRef}
      sitekey={sitekey}
      size="invisible"
      badge={badge}
      onErrored={onErrored}
      onLoad={() => setReady(true)}
    />
  )
})

RecaptchaClient.displayName = 'RecaptchaClient'
export default RecaptchaClient
