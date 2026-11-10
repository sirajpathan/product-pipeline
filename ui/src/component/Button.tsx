import type { ButtonHTMLAttributes } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>

function Button({ className = '', ...props }: ButtonProps) {
  return <button className={className} {...props} />
}

export default Button
