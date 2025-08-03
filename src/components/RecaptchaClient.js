import React, { useEffect, useImperativeHandle, forwardRef, useRef } from 'react';
import ReCAPTCHA from 'react-google-recaptcha';

const RecaptchaClient = forwardRef(({ sitekey, onErrored }, ref) => {
  const internalRef = useRef();

  useImperativeHandle(ref, () => ({
    async executeAsync() {
      if (internalRef.current?.executeAsync) {
        return await internalRef.current.executeAsync();
      } else {
        throw new Error('executeAsync is not beschikbaar op reCAPTCHA');
      }
    },
    reset() {
      internalRef.current?.reset?.();
    },
  }));

  return (
    <ReCAPTCHA
      ref={internalRef}
      size="invisible"
      sitekey={sitekey}
      onErrored={onErrored}
    />
  );
});

RecaptchaClient.displayName = 'RecaptchaClient';
export default RecaptchaClient;
