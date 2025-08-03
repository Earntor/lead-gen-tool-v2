import { useRef, forwardRef, useImperativeHandle } from 'react'
import ReCAPTCHA from 'react-google-recaptcha'

const RecaptchaClient = forwardRef(({ sitekey, onErrored }, ref) => {
  const internalRef = useRef(null)

  useImperativeHandle(ref, () => ({
    executeAsync: async () => {
      if (!internalRef.current) throw new Error('Geen reCAPTCHA referentie')
      if (typeof internalRef.current.executeAsync !== 'function') {
        throw new Error('executeAsync is niet beschikbaar')
      }
      return await internalRef.current.executeAsync()
    },
    reset: () => {
      internalRef.current?.reset?.()
    },
  }))

  return (
    <ReCAPTCHA
      ref={internalRef}
      sitekey={sitekey}
      size="invisible"
      badge="bottomright"
      onErrored={onErrored}
    />
  )
})

RecaptchaClient.displayName = 'RecaptchaClient'
export default RecaptchaClient
