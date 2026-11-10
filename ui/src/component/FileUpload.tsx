import { useState, type ChangeEvent, type DragEvent } from 'react'

type FileUploadProps = {
  file: File | null
  disabled?: boolean
  onFileSelected: (file: File | undefined) => void
}

function FileUpload({
  file,
  disabled = false,
  onFileSelected,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    onFileSelected(event.currentTarget.files?.[0])
    event.currentTarget.value = ''
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setIsDragging(false)
    onFileSelected(event.dataTransfer.files[0])
  }

  return (
    <label
      className={`upload-dropzone${isDragging ? ' is-dragging' : ''}${file ? ' has-file' : ''}`}
      htmlFor="csv-file"
      onDragEnter={(event) => {
        event.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        setIsDragging(false)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <input
        accept=".csv,text/csv"
        className="file-input"
        disabled={disabled}
        id="csv-file"
        onChange={handleFileChange}
        type="file"
      />
      <span className="upload-symbol" aria-hidden="true">
        ↑
      </span>
      {file ? (
        <>
          <span className="selected-file">{file.name}</span>
          <span className="dropzone-hint">
            {(file.size / 1024 / 1024).toFixed(2)} MB ·{' '}
            <span className="browse-link">Choose another file</span>
          </span>
        </>
      ) : (
        <>
          <span className="dropzone-title">
            Drop your CSV here, or <span className="browse-link">browse</span>
          </span>
          <span className="dropzone-hint">CSV files only</span>
        </>
      )}
    </label>
  )
}

export default FileUpload
