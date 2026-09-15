import { Box, Button, Stack } from '@primer/react'

// Moldura (borda, padding, Stack) e a linha de botões Cancelar/Salvar, idênticas hoje em
// ExerciseForm, CommunityForm e BodyMeasurementForm. Os campos de cada formulário vão como
// children; lógica de values/errors/submitting fica em useFormState.
export function FormShell({ onSubmit, onCancel, submitting, children }) {
  return (
    <Box
      as="form"
      onSubmit={onSubmit}
      sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3, mb: 3 }}
    >
      <Stack gap="condensed">
        {children}
        <Box
          sx={{
            display: 'flex',
            flexDirection: ['column-reverse', 'row'],
            gap: 2,
            justifyContent: ['stretch', 'flex-end'],
          }}
        >
          <Button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            sx={{ width: ['100%', 'auto'] }}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={submitting}
            sx={{ width: ['100%', 'auto'] }}
          >
            Salvar
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}
