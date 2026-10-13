import { useState } from 'react'
import { Button } from '@primer/react'
import { TrashIcon } from '@primer/octicons-react'
import { canDeleteVisualVersion } from '../../utils/exerciseVisualReview'

export function ExerciseVisualDeleteButton({ set, busy, disabled, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  if (!canDeleteVisualVersion(set)) return null
  return (
    <div className="ev-delete">
      {!confirming ? (
        <Button
          size="small"
          leadingVisual={TrashIcon}
          disabled={disabled || Boolean(busy)}
          onClick={() => setConfirming(true)}
        >
          Excluir versão
        </Button>
      ) : (
        <>
          <p>
            Excluir definitivamente a versão {set.version} e seus arquivos? Esta ação não pode ser
            desfeita. O servidor protege versões publicadas e arquivos em uso.
          </p>
          <div className="ev-actions">
            <Button
              size="small"
              variant="danger"
              disabled={disabled || Boolean(busy)}
              onClick={() => onDelete(set.id)}
            >
              Confirmar exclusão
            </Button>
            <Button size="small" disabled={Boolean(busy)} onClick={() => setConfirming(false)}>
              Cancelar exclusão
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
