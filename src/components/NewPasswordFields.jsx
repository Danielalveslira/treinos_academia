import { FormControl, TextInput } from '@primer/react'

// Compartilhado por ResetPassword.jsx e ConfirmEmail.jsx (mesma etapa "defina uma senha
// nova", só o que acontece antes e depois é diferente -- ver validatePasswordConfirmation).
export function NewPasswordFields({
  password,
  onPasswordChange,
  confirmPassword,
  onConfirmPasswordChange,
  fieldErrors,
}) {
  return (
    <>
      <FormControl required>
        <FormControl.Label>Nova senha</FormControl.Label>
        <TextInput
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          size="large"
          block
        />
        <FormControl.Caption>Mínimo de 8 caracteres, com letras e números.</FormControl.Caption>
        {fieldErrors.password && (
          <FormControl.Validation variant="error">{fieldErrors.password}</FormControl.Validation>
        )}
      </FormControl>

      <FormControl required>
        <FormControl.Label>Confirmar nova senha</FormControl.Label>
        <TextInput
          type="password"
          value={confirmPassword}
          onChange={(e) => onConfirmPasswordChange(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          size="large"
          block
        />
        {fieldErrors.confirmPassword && (
          <FormControl.Validation variant="error">
            {fieldErrors.confirmPassword}
          </FormControl.Validation>
        )}
      </FormControl>
    </>
  )
}
