import Tabs from '../../app/model/tabs';
import Tab from '../../app/model/tab';

describe('model/tabs', () => {
  describe('addTab', () => {
    it('should add a new tab in tab list', () => {
      const tabs = new Tabs();
      expect(tabs.size).toEqual(0);

      const tab = new Tab();
      tabs.addTab(tab);
      expect(tabs.size).toEqual(1);

      const tab2 = new Tab();
      tabs.addTab(tab2);
      expect(tabs.size).toEqual(2);
    });
  });

  describe('removeTab', () => {
    it('should remove a tab by instance', () => {
      const tabs = new Tabs();

      const tab = new Tab();
      tabs.addTab(tab);

      tabs.removeTab(tab);
      expect(tabs.size).toEqual(0);
    });
  });

  describe('removeSavedTab', () => {
    it('should remove all saved tabs', () => {
      const tabs = new Tabs();

      const tab = new Tab();
      tabs.addTab(tab);

      const tab2 = new Tab();
      tabs.addTab(tab2);

      const tab3 = new Tab();
      tab3.saved = false;
      tabs.addTab(tab3);

      tabs.removeSavedTab();
      expect(tabs.size).toEqual(1);

      for (let item of tabs.tabs) {
        expect(item.saved).toEqual(false);
      }
    });
  });

  describe('removeAll', () => {
    it('should remove all tabs', () => {
      const tabs = new Tabs();

      const tab = new Tab();
      tabs.addTab(tab);

      const tab2 = new Tab();
      tabs.addTab(tab2);

      tabs.removeAll();
      expect(tabs.size).toEqual(0);
      expect(tabs.isEmpty()).toBe(true);
    });
  });

  describe('findTabIdx', () => {
    const tabs = new Tabs();
    const tab1 = new Tab();
    const tab2 = new Tab();
    tabs.addTab(tab1);
    tabs.addTab(tab2);

    it('should be 0', () => {
      expect(tabs.findTabIdx(tab1)).toEqual(0);
    });

    it('should be 1', () => {
      expect(tabs.findTabIdx(tab2)).toEqual(1);
    });

    it('should be -1', () => {
      expect(tabs.findTabIdx(null)).toEqual(-1);
      expect(tabs.findTabIdx(undefined)).toEqual(-1);
      expect(tabs.findTabIdx(new Tab())).toEqual(-1);
    });
  });

  describe('removeLeft', () => {
    it('should remove tabs on the left side of tab', () => {
      // TODO:
    });
  });

  describe('removeRight', () => {
    it('should remove tabs on the right side of tab', () => {
      // TODO:
    });
  });
});
