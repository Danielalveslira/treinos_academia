import { ActionMenu, ActionList, IconButton } from '@primer/react'
import { KebabHorizontalIcon } from '@primer/octicons-react'

export function RowActionsMenu({ actions, disabled = false, label = 'Mais ações', triggerRef }) {
  return (
    <ActionMenu>
      <ActionMenu.Anchor>
        <IconButton
          ref={triggerRef}
          disabled={disabled}
          icon={KebabHorizontalIcon}
          variant="invisible"
          aria-label={label}
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
