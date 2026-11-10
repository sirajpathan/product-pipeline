import type { InputHTMLAttributes } from 'react'

type InputFieldProps = InputHTMLAttributes<HTMLInputElement>

function InputField({ className = '', ...props }: InputFieldProps) {
  return <input className={className} {...props} />
}

export default InputField
