import Tabs from '../model/tabs';
import Tab from '../model/tab';
import TabsAction from '../actions/tabs';

const tabs = new Tabs();

// tabs.addTab(new Tab({ data: { name: 'Tabs.md' } }));
// tabs.addTab(new Tab({ data: { name: 'README.md' } }));
// tabs.addTab(new Tab({ data: { name: 'Javascript in Action.md' } }));
// tabs.addTab(new Tab({ data: { name: 'Flutter App introduction.md' } }));
// tabs.addTab(new Tab({ data: { name: '21天精通c++.md' } }));

export const initState = function() {
  return {
    tabs: tabs
  };
};

export default (state = initState(), action) => {
  switch (action.type) {
    case TabsAction.UPDATE_TAB_ORDER: {
      const { dragProps, dropProps } = action.payload;
      tabs.swapTab(dragProps.item, dropProps.item);
    }
  }
  return {
    ...state,
    tabs: tabs.getArray(),
    isEmpty: tabs.isEmpty()
  };
};
