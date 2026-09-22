export function initialParticipantsDialogState() {
  return { participants: [], cursor: null, loaded: false, loading: false, error: '' }
}

export function participantsDialogReducer(state, action) {
  switch (action.type) {
    case 'load_start':
      return { ...state, loading: true, error: '' }
    case 'load_success':
      return {
        ...state,
        loading: false,
        participants: action.reset
          ? action.participants
          : [...state.participants, ...action.participants],
        cursor: action.nextCursor,
        loaded: true,
      }
    case 'load_error':
      return { ...state, loading: false, error: action.message }
    default:
      return state
  }
}
