import produce from "immer"

export function initState() {
  return {
    content: ''
  };
}

export default (state = initState(), action) => 
  produce(state, draft => {
    switch (action.type) {
      case 'UPDATE_CONTENT': 
        draft.content = action.payload.content
  }})
;
