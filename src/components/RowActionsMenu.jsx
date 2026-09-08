import { ActionMenu, ActionList, IconButton } from '@primer/react'
import { KebabHorizontalIcon, PencilIcon, TrashIcon } from '@primer/octicons-react'

export function RowActionsMenu({ onEdit, onDelete }) {
  return (
    <ActionMenu>
      <ActionMenu.Anchor>
        <IconButton
          icon={KebabHorizontalIcon}
          variant="invisible"
          aria-label="Mais ações"
          size="large"
          sx={{ color: 'fg.muted' }}
        />
      </ActionMenu.Anchor>
      <ActionMenu.Overlay align="end">
        <ActionList>
          <ActionList.Item onSelect={onEdit}>
            <ActionList.LeadingVisual>
              <PencilIcon />
            </ActionList.LeadingVisual>
            Editar
          </ActionList.Item>
          <ActionList.Item variant="danger" onSelect={onDelete}>
            <ActionList.LeadingVisual>
              <TrashIcon />
            </ActionList.LeadingVisual>
            Excluir
          </ActionList.Item>
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}
