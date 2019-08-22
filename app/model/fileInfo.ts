// describe the FileInfo
export default class FileInfo {
  // some properties of file
  private _filename = '';
  private _fileExtention = null;
  private _fileStatus = null;

  // get filename
  get filename() {
    return this._filename;
  }

  // set filename
  set filename(name) {
    this.filename = name;
  }

  // get file extention
  get fileExtention() {
    return this._fileExtention;
  }

  // set file extention
  set fileExtention(extention) {
    this._fileExtention = extention;
  }

  // get file status
  get fileStatus() {
    return this._fileStatus;
  }

  // set file status
  set fileStatus(status: 'NO_MODIFY' | 'NEW_FILE' | 'MODIFYED') {
    this._fileStatus = status;
  }
}
