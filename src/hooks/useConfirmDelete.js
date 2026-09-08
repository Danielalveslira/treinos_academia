import { useConfirm } from '@primer/react'

export function useConfirmDelete() {
  const confirm = useConfirm()

  return function confirmDelete({ title, content }) {
    return confirm({
      title,
      content,
      confirmButtonContent: 'Excluir',
      confirmButtonType: 'danger',
      cancelButtonContent: 'Cancelar',
    })
  }
}
