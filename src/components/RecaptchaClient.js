import { forwardRef, useImperativeHandle, useRef } from 'react'
import ReCAPTCHA from 'react-google-recaptcha'

const RecaptchaClient = forwardRef(function RecaptchaClient(props, ref) {
  const internalRef = useRef()

  useImperativeHandle(ref, () => ({
    executeAsync: () => internalRef.current.executeAsync(),
    reset: () => internalRef.current.reset(),
  }))

  return (
    <ReCAPTCHA
      ref={internalRef}
      size="invisible"
      sitekey={props.sitekey}
      badge={props.badge || 'bottomright'}
      onErrored={props.onErrored}
      onExpired={props.onExpired}
      onChange={props.onChange}
    />
  )
})

export default RecaptchaClient
