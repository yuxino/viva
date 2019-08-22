import Tab from '../../app/model/Tab';

describe('model/tabs', () => {
  it('when init saved should be ture', () => {
    const tab = new Tab();
    expect(tab.saved).toEqual(true);
  });

  it('saved should be modify to false', () => {
    const tab = new Tab();
    tab.saved = false;
    expect(tab.saved).toEqual(false);
  });
});
