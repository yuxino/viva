import Tabs from '../model/Tabs';
import Tab from '../model/Tab';
import TabsAction from '../actions/tabs';

const tabs = new Tabs();

export const initState = function() {
  return {
    tabs: tabs
  };
};

export default (state = initState(), action) => {
  switch (action.type) {
    // add a new tab in tabs
    case TabsAction.ADD_NEW_TAB: {
      const { name } = action.payload;
      tabs.addTab(new Tab({ data: { name } }));
      break;
    }
    // update tab order in tabs
    case TabsAction.UPDATE_TAB_ORDER: {
      const { dragProps, dropProps } = action.payload;
      tabs.swapTab(dragProps.item, dropProps.item);
      break;
    }
    // remove a tab in tabs
    case TabsAction.CLOSE_TAB: {
      const { tab } = action.payload;
      tabs.removeTab(tab);
      break;
    }
  }
  return {
    ...state,
    tabs: tabs.getArray(),
    isEmpty: tabs.isEmpty()
  };
};
