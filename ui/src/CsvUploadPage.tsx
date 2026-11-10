import { useState, type FormEvent } from 'react'
import { apiRequest } from './api'
import './App.css'
import Button from './component/Button'
import FileUpload from './component/FileUpload'
import NavigationBar from './component/NavigationBar'

type UploadStage =
  | 'idle'
  | 'uploading'
  | 'complete'
  | 'failed'

async function getErrorMessage(response: Response) {
  const body = await response.text()
  return body.trim() || `Request failed with status ${response.status}.`
}

function CsvUploadPage() {
  const [file, setFile] = useState<File | null>(null)
  const [stage, setStage] = useState<UploadStage>('idle')
  const [error, setError] = useState('')

  const isUploading = stage === 'uploading'

  function selectFile(nextFile: File | undefined) {
    if (!nextFile) return

    if (!nextFile.name.toLowerCase().endsWith('.csv')) {
      setFile(null)
      setStage('idle')
      setError('Choose a file with the .csv extension.')
      return
    }

    setFile(nextFile)
    setStage('idle')
    setError('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || isUploading) return

    setError('')

    try {
      setStage('uploading')
      const formData = new FormData()
      formData.append('file', file)
      const uploadResponse = await apiRequest('/file/upload', {
        method: 'POST',
        body: formData,
      })

      if (!uploadResponse.ok) {
        throw new Error(await getErrorMessage(uploadResponse))
      }

      setStage('complete')
    } catch (uploadError) {
      setStage('failed')
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : 'An unexpected error occurred while uploading the file.',
      )
    }
  }

  function getStepClass(step: 'select' | 'upload' | 'complete') {
    if (stage === 'complete') return 'is-complete'
    if (step === 'select') {
      return file ? 'is-complete' : 'is-current'
    }
    if (step === 'upload' && (stage === 'uploading' || stage === 'failed')) {
      return 'is-current'
    }
    return ''
  }

  return (
    <main className="upload-page">
      <NavigationBar activePage="upload" />

      <section className="upload-layout" aria-labelledby="upload-title">
        <div className="upload-heading">
          <span className="eyebrow">YOUR WORKSPACE</span>
          <h1 id="upload-title">Upload a CSV file</h1>
          <p>Bring your data into Forma to get started.</p>
        </div>

        <form className="upload-card" onSubmit={handleSubmit}>
          <div className="card-heading">
            <div className="file-icon" aria-hidden="true">
              <span>.CSV</span>
            </div>
            <div>
              <h2>Select your file</h2>
              <p>Choose a CSV from your device to upload.</p>
            </div>
          </div>

          <FileUpload
            disabled={isUploading}
            file={file}
            onFileSelected={selectFile}
          />

          <div className="upload-steps" aria-label="Upload steps">
            <div className={`upload-step ${getStepClass('select')}`}>
              <span className="step-indicator">1</span>
              <span>Select file</span>
            </div>
            <span className="step-connector" aria-hidden="true" />
            <div className={`upload-step ${getStepClass('upload')}`}>
              <span className="step-indicator">2</span>
              <span>Upload file</span>
            </div>
            <span className="step-connector" aria-hidden="true" />
            <div className={`upload-step ${getStepClass('complete')}`}>
              <span className="step-indicator">3</span>
              <span>Complete</span>
            </div>
          </div>

          {error && (
            <p className="upload-error" role="alert">
              {error}
            </p>
          )}
          {stage === 'complete' && (
            <p className="upload-success" role="status">
              Your file was uploaded successfully.
            </p>
          )}

          <Button
            className="upload-button"
            disabled={!file || isUploading}
            type="submit"
          >
            {stage === 'uploading' && 'Uploading file…'}
            {(stage === 'idle' || stage === 'failed') && (
              <>
                Upload CSV <span aria-hidden="true">→</span>
              </>
            )}
            {stage === 'complete' && (
              <>
                Upload another file <span aria-hidden="true">→</span>
              </>
            )}
          </Button>
        </form>

        <p className="privacy-note">
          <span aria-hidden="true">✦</span>
          Your CSV is sent directly to the upload API.
        </p>
      </section>

      <footer className="page-footer">
        <span>© 2026 Siraj</span>
        <span>Thoughtful work starts here.</span>
      </footer>
    </main>
  )
}

export default CsvUploadPage
