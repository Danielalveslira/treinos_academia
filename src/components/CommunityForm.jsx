import { useState } from 'react'
import { FormControl, TextInput, Select, Textarea } from '@primer/react'
import { validateCommunity } from '../utils/validators'
import { DEFAULT_COMMUNITY_ICON_NAME } from '../constants/communityIcons'
import { CommunityIconPicker } from './CommunityIconPicker'
import { CommunityCoverPicker } from './CommunityCoverPicker'
import { useFormState } from '../hooks/useFormState'
import { FormShell } from './FormShell'

const EMPTY = { name: '', description: '', postAccess: 'everyone', iconName: DEFAULT_COMMUNITY_ICON_NAME }

export function CommunityForm({ initialValue, onSubmit, onCancel, showPostAccess = true }) {
  const { values, setField, errors, submitting, handleSubmit } = useFormState({
    initialValues: initialValue ? { ...EMPTY, ...initialValue } : EMPTY,
    validate: validateCommunity,
    onSubmit,
  })
  // A capa só existe depois que a comunidade existe (caminho no Storage é
  // {communityId}.webp) -- por isso fica fora do useFormState/onSubmit, só em edição.
  const [coverPath, setCoverPath] = useState(initialValue?.coverPath ?? null)

  return (
    <FormShell onSubmit={handleSubmit} onCancel={onCancel} submitting={submitting}>
      {initialValue?.id && (
        <CommunityCoverPicker
          communityId={initialValue.id}
          coverPath={coverPath}
          onUploaded={setCoverPath}
        />
      )}
      <FormControl required>
        <FormControl.Label>Nome</FormControl.Label>
        <TextInput
          value={values.name}
          onChange={(e) => setField('name', e.target.value)}
          block
          autoFocus
        />
        {errors.name && (
          <FormControl.Validation variant="error">{errors.name}</FormControl.Validation>
        )}
      </FormControl>

      <FormControl>
        <FormControl.Label>Descrição</FormControl.Label>
        <Textarea
          value={values.description}
          onChange={(e) => setField('description', e.target.value)}
          rows={2}
          block
        />
        {errors.description && (
          <FormControl.Validation variant="error">{errors.description}</FormControl.Validation>
        )}
      </FormControl>

      <FormControl>
        <FormControl.Label>Ícone</FormControl.Label>
        <CommunityIconPicker
          value={values.iconName}
          onChange={(iconName) => setField('iconName', iconName)}
          name={values.name}
        />
        {errors.iconName && (
          <FormControl.Validation variant="error">{errors.iconName}</FormControl.Validation>
        )}
      </FormControl>

      {showPostAccess && (
        <FormControl>
          <FormControl.Label>Quem pode publicar</FormControl.Label>
          <Select
            value={values.postAccess}
            onChange={(e) => setField('postAccess', e.target.value)}
            block
          >
            <Select.Option value="everyone">Todos os membros</Select.Option>
            <Select.Option value="admins">Somente moderadores</Select.Option>
          </Select>
          <FormControl.Caption>
            Com "Somente moderadores", membros comuns só podem visualizar as publicações
            (ex: uma comunidade de avisos oficiais). Moderadores são o superadmin e, na
            própria comunidade, o dono dela.
          </FormControl.Caption>
        </FormControl>
      )}

      {initialValue && (
        <FormControl>
          <FormControl.Label>Status</FormControl.Label>
          <Select
            value={values.isActive ? 'active' : 'inactive'}
            onChange={(e) => setField('isActive', e.target.value === 'active')}
            block
          >
            <Select.Option value="active">Ativa</Select.Option>
            <Select.Option value="inactive">Inativa</Select.Option>
          </Select>
        </FormControl>
      )}
    </FormShell>
  )
}
