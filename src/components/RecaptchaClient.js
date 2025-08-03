import { useRef, forwardRef, useImperativeHandle } from 'react'
import ReCAPTCHA from 'react-google-recaptcha'

const RecaptchaClient = forwardRef(({ sitekey, badge = 'bottomright', onErrored, onChange }, ref) => {
  const internalRef = useRef(null)

  useImperativeHandle(ref, () => ({
    execute() {
      if (internalRef.current?.execute) {
        internalRef.current.execute()
      } else {
        throw new Error('reCAPTCHA execute is undefined')
      }
    },
    reset() {
      internalRef.current?.reset?.()
    }
  }))

  return (
    <ReCAPTCHA
      ref={internalRef}
      sitekey={sitekey}
      size="invisible"
      badge={badge}
      onErrored={onErrored}
      onChange={onChange}
    />
  )
})

RecaptchaClient.displayName = 'RecaptchaClient'
export default RecaptchaClient
