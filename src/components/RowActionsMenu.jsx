import { ActionMenu, ActionList, IconButton } from '@primer/react'
import { KebabHorizontalIcon } from '@primer/octicons-react'

export function RowActionsMenu({ actions, disabled = false }) {
  return (
    <ActionMenu>
      <ActionMenu.Anchor>
        <IconButton
          disabled={disabled}
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
              <ActionList.Item
                key={action.key}
                variant={action.variant}
                disabled={disabled || action.disabled}
                onSelect={action.onSelect}
              >
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
