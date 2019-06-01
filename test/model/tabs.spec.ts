import Tabs from '../../app/model/tabs';
import Tab from '../../app/model/tab';

class TestTabs extends Tabs {
  getArray() {
    let item = this.head;
    let array = [];
    while (item) {
      array.push(item['name']);
      item = item.next;
    }
    return array;
  }
}

class TestTab extends Tab {
  public name: string;
  constructor(name) {
    super();
    this.name = name;
  }
}

describe('model/tabs', () => {
  describe('addTab', () => {
    it('head node is equal tail node', () => {
      const tabs = new TestTabs();
      const tab1 = new TestTab(1);
      tabs.addTab(tab1);

      expect(tabs.head).toEqual(tabs.tail);
    });

    it('order should be 1,2,3', () => {
      const tabs = new TestTabs();
      const tab1 = new TestTab(1);
      const tab2 = new TestTab(2);
      const tab3 = new TestTab(3);

      tabs.addTab(tab1);
      tabs.addTab(tab2);
      tabs.addTab(tab3);

      expect(tabs.head).toBe(tab1);
      expect(tabs.getArray()).toEqual([1, 2, 3]);
      expect(tabs.tail).toBe(tab3);
    });

    it('order should be 3,2,1', () => {
      const tabs = new TestTabs();
      const tab1 = new TestTab(1);
      const tab2 = new TestTab(2);
      const tab3 = new TestTab(3);

      tabs.addTab(tab3);
      tabs.addTab(tab2);
      tabs.addTab(tab1);

      expect(tabs.head).toBe(tab3);
      expect(tabs.getArray()).toEqual([3, 2, 1]);
      expect(tabs.tail).toBe(tab1);
    });
  });

  describe('removeTab', () => {
    it('remove only one tab', () => {
      const tabs = new TestTabs();
      const tab1 = new TestTab(1);

      tabs.addTab(tab1);

      tabs.removeTab(tab1);

      expect(tabs.head).toBe(null);
      expect(tabs.getArray()).toEqual([]);
      expect(tabs.tail).toBe(null);
      expect(tabs.size).toBe(0);
    });

    it('remove second tab order should be 1,3', () => {
      const tabs = new TestTabs();
      const tab1 = new TestTab(1);
      const tab2 = new TestTab(2);
      const tab3 = new TestTab(3);

      tabs.addTab(tab1);
      tabs.addTab(tab2);
      tabs.addTab(tab3);

      tabs.removeTab(tab2);

      expect(tabs.head).toBe(tab1);
      expect(tabs.getArray()).toEqual([1, 3]);
      expect(tabs.tail).toBe(tab3);
      expect(tabs.size).toBe(2);
    });

    it('remove first tab order should be 2,3, head.prev should be null', () => {
      const tabs = new TestTabs();
      const tab1 = new TestTab(1);
      const tab2 = new TestTab(2);
      const tab3 = new TestTab(3);

      tabs.addTab(tab1);
      tabs.addTab(tab2);
      tabs.addTab(tab3);

      tabs.removeTab(tab1);

      expect(tabs.head).toBe(tab2);
      expect(tabs.head.prev).toBe(null);
      expect(tabs.getArray()).toEqual([2, 3]);
      expect(tabs.tail).toBe(tab3);
      expect(tabs.tail.next).toBe(null);
      expect(tabs.size).toBe(2);
    });

    it('remove last tab order should be 1,2, tail.next should be null', () => {
      const tabs = new TestTabs();
      const tab1 = new TestTab(1);
      const tab2 = new TestTab(2);
      const tab3 = new TestTab(3);

      tabs.addTab(tab1);
      tabs.addTab(tab2);
      tabs.addTab(tab3);

      tabs.removeTab(tab3);

      expect(tabs.head).toBe(tab1);
      expect(tabs.getArray()).toEqual([1, 2]);
      expect(tabs.tail).toBe(tab2);
      expect(tabs.tail.next).toBe(null);
      expect(tab3.next).toBe(null);
      expect(tabs.size).toBe(2);
    });
  });

  describe('removeSavedTab', () => {
    it('should remove all saved tabs', () => {
      const tabs = new TestTabs();

      const tab1 = new TestTab(1);
      tabs.addTab(tab1);

      const tab2 = new TestTab(2);
      tabs.addTab(tab2);

      const tab3 = new TestTab(3);
      tab3.saved = false;
      tabs.addTab(tab3);

      tabs.removeSavedTab();

      expect(tabs.size).toBe(1);
      expect(tabs.getArray()).toEqual([3]);
    });
  });

  describe('removeAll', () => {
    it('should remove all tabs', () => {
      const tabs = new TestTabs();

      const tab = new TestTab(1);
      tabs.addTab(tab);

      const tab2 = new TestTab(2);
      tabs.addTab(tab2);

      tabs.removeAll();
      expect(tabs.size).toBe(0);
      expect(tabs.size).toBe(0);
      expect(tabs.isEmpty()).toBe(true);
    });
  });

  describe('removeLeft', () => {
    it('removeLeft when only one tab', () => {
      const tabs = new TestTabs();
      const tab1 = new TestTab(1);
      tabs.addTab(tab1);
      tabs.removeLeft(tab1);

      expect(tabs.size).toBe(1);
      expect(tabs.head).toBe(tab1);
      expect(tabs.tail).toBe(tab1);
      expect(tabs.head.prev).toBe(null);
      expect(tabs.head).toEqual(tabs.tail);
      expect(tabs.getArray()).toEqual([1]);
    });

    it('should remove tabs on the left side of first tab', () => {
      const tabs = new TestTabs();
      const tab1 = new TestTab(1);
      tabs.addTab(tab1);

      const tab2 = new TestTab(2);
      tabs.addTab(tab2);

      const tab3 = new TestTab(3);
      tabs.addTab(tab3);

      const tab4 = new TestTab(4);
      tabs.addTab(tab4);

      const tab5 = new TestTab(5);
      tabs.addTab(tab5);

      tabs.removeLeft(tab1);

      expect(tabs.size).toBe(5);
      expect(tabs.head).toBe(tab1);
      expect(tabs.tail).toBe(tab5);
      expect(tabs.head.prev).toBe(null);
      expect(tabs.getArray()).toEqual([1, 2, 3, 4, 5]);
    });

    it('should remove tabs on the left side of tab', () => {
      const tabs = new TestTabs();
      const tab1 = new TestTab(1);
      tabs.addTab(tab1);

      const tab2 = new TestTab(2);
      tabs.addTab(tab2);

      const tab3 = new TestTab(3);
      tabs.addTab(tab3);

      const tab4 = new TestTab(4);
      tabs.addTab(tab4);

      const tab5 = new TestTab(5);
      tabs.addTab(tab5);

      tabs.removeLeft(tab3);

      expect(tabs.size).toBe(3);
      expect(tabs.head).toBe(tab3);
      expect(tabs.tail).toBe(tab5);
      expect(tabs.head.prev).toBe(null);
      expect(tabs.getArray()).toEqual([3, 4, 5]);
    });
  });

  describe('removeRight', () => {
    it('removeRight when only one tab', () => {
      const tabs = new TestTabs();
      const tab1 = new TestTab(1);
      tabs.addTab(tab1);
      tabs.removeRight(tab1);

      expect(tabs.size).toBe(1);
      expect(tabs.head).toBe(tab1);
      expect(tabs.tail).toBe(tab1);
      expect(tabs.tail.prev).toBe(null);
      expect(tabs.tail).toEqual(tabs.head);
      expect(tabs.getArray()).toEqual([1]);
    });

    it('should remove tabs on the rgiht side of last tab', () => {
      const tabs = new TestTabs();
      const tab1 = new TestTab(1);
      tabs.addTab(tab1);

      const tab2 = new TestTab(2);
      tabs.addTab(tab2);

      const tab3 = new TestTab(3);
      tabs.addTab(tab3);

      const tab4 = new TestTab(4);
      tabs.addTab(tab4);

      const tab5 = new TestTab(5);
      tabs.addTab(tab5);

      tabs.removeRight(tab5);

      expect(tabs.size).toBe(5);
      expect(tabs.head).toBe(tab1);
      expect(tabs.tail).toBe(tab5);
      expect(tabs.tail.next).toBe(null);
      expect(tabs.getArray()).toEqual([1, 2, 3, 4, 5]);
    });

    it('should remove tabs on the right side of tab', () => {
      const tabs = new TestTabs();
      const tab1 = new TestTab(1);
      tabs.addTab(tab1);

      const tab2 = new TestTab(2);
      tabs.addTab(tab2);

      const tab3 = new TestTab(3);
      tabs.addTab(tab3);

      const tab4 = new TestTab(4);
      tabs.addTab(tab4);

      const tab5 = new TestTab(5);
      tabs.addTab(tab5);

      tabs.removeRight(tab3);

      expect(tabs.size).toBe(3);
      expect(tabs.head).toBe(tab1);
      expect(tabs.tail).toBe(tab3);
      expect(tabs.tail.next).toBe(null);
      expect(tabs.getArray()).toEqual([1, 2, 3]);
    });
  });
});
