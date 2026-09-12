import { ActionMenu, ActionList, IconButton } from '@primer/react'
import { KebabHorizontalIcon } from '@primer/octicons-react'

export function RowActionsMenu({ actions }) {
  return (
    <ActionMenu>
      <ActionMenu.Anchor>
        <IconButton
          icon={KebabHorizontalIcon}
          variant="invisible"
          aria-label="Mais ações"
          sx={{ color: 'fg.muted' }}
        />
      </ActionMenu.Anchor>
      <ActionMenu.Overlay align="end">
        <ActionList>
          {actions.map((action) => {
            const Icon = action.icon
            return (
              <ActionList.Item key={action.key} variant={action.variant} onSelect={action.onSelect}>
                <ActionList.LeadingVisual>
                  <Icon />
                </ActionList.LeadingVisual>
                {action.label}
              </ActionList.Item>
            )
          })}
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}
