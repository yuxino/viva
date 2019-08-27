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
    case TabsAction.ADD_NEW_TAB: {
      const { name } = action.payload;
      tabs.addTab(new Tab({ data: { name } }));
      break;
    }
    case TabsAction.UPDATE_TAB_ORDER: {
      const { dragProps, dropProps } = action.payload;
      tabs.swapTab(dragProps.item, dropProps.item);
      break;
    }
  }
  return {
    ...state,
    tabs: tabs.getArray(),
    isEmpty: tabs.isEmpty()
  };
};
