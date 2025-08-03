import { forwardRef, useImperativeHandle } from 'react'
import ReCAPTCHA from 'react-google-recaptcha'

const RecaptchaClient = forwardRef((props, ref) => {
  let recaptchaRef

  useImperativeHandle(ref, () => ({
    executeAsync: async () => {
      if (recaptchaRef) {
        return await recaptchaRef.executeAsync()
      }
      return null
    },
    reset: () => {
      recaptchaRef?.reset()
    },
  }))

  return (
    <ReCAPTCHA
      {...props}
      ref={(r) => (recaptchaRef = r)}
      size="invisible"
    />
  )
})

export default RecaptchaClient
