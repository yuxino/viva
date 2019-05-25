export function initState() {
  return {
    content: ''
  };
}

export default (state = initState(), action) => {
  switch (action.type) {
    case 'UPDATE_CONTENT':
      return {
        ...state,
        content: action.payload.content
      };
    default:
      return state;
  }
};
