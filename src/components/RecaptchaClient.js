'use client'

import { forwardRef, useRef, useImperativeHandle } from 'react'
import ReCAPTCHA from 'react-google-recaptcha'

const RecaptchaClient = forwardRef((props, ref) => {
  const internalRef = useRef()

  useImperativeHandle(ref, () => ({
    executeAsync: () => internalRef.current?.executeAsync(),
    reset: () => internalRef.current?.reset(),
  }))

  return (
    <ReCAPTCHA
      ref={internalRef}
      size="invisible"
      {...props}
    />
  )
})

export default RecaptchaClient
