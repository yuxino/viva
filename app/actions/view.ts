enum View {
  ALL_UPDATE = 'VIEW_ALL_UPDATE', // update all views  (SIDE_EFFECT)
  EXPLORE_UPDATE = 'VIEW_EXPLORE_UPDATE', // update explore view (SIDE_EFFECT)
  UPDATE_EDITOR_SYNC_FN = 'VIEW_UPDATE_EDITOR_SYNC_FN', // update sync function
  CALL_EDITOR_SYNC_FN = 'VIEW_CALL_EDITOR_SYNC_FN', // call sync function
  CLEAR_EDITOR_CONTENT = "VIEW_CLEAR_EDITOR_CONTENT", // clear editor content
  // FOR SAGA
  TABS_UPDATE = 'VIEW_TABS_UPDATE', // update tabs view (SIDE_EFFECT)
  CLOSE_TAB = 'VIEW_CLOSE_TAB' // when close a tab
}

export default View;
