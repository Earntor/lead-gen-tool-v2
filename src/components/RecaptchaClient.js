'use client'

import { forwardRef, useRef, useImperativeHandle } from 'react'
import ReCAPTCHA from 'react-google-recaptcha'

const RecaptchaClient = forwardRef((props, ref) => {
  const internalRef = useRef(null)

  useImperativeHandle(ref, () => ({
    executeAsync: async () => {
      if (internalRef.current && typeof internalRef.current.executeAsync === 'function') {
        return await internalRef.current.executeAsync()
      }
      throw new Error('executeAsync niet beschikbaar')
    },
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

RecaptchaClient.displayName = 'RecaptchaClient'

export default RecaptchaClient
