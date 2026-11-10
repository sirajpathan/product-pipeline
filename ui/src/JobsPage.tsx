import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from './api'
import NavigationBar from './component/NavigationBar'
import './JobsPage.css'

type Job = {
  id: string | number
  file_name: string
  status: string
  created_at: string
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isJob(value: unknown): value is Job {
  return (
    isRecord(value) &&
    (typeof value.id === 'string' || typeof value.id === 'number') &&
    typeof value.file_name === 'string' &&
    typeof value.status === 'string' &&
    typeof value.created_at === 'string'
  )
}

function getJobs(value: unknown): Job[] {
  if (
    !isRecord(value) ||
    value.status !== 'ok' ||
    !Array.isArray(value.jobs) ||
    !value.jobs.every(isJob)
  ) {
    throw new Error('The jobs API returned data in an unexpected format.')
  }

  return value.jobs
}

async function getErrorMessage(response: Response) {
  const body = await response.text()
  return body.trim() || `Request failed with status ${response.status}.`
}

function formatCreatedAt(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const loadJobs = useCallback(async () => {
    setIsLoading(true)
    setError('')

    try {
      const response = await apiRequest('/jobs')
      if (!response.ok) {
        throw new Error(await getErrorMessage(response))
      }

      setJobs(getJobs(await response.json()))
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'An unexpected error occurred while loading jobs.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  return (
    <main className="upload-page">
      <NavigationBar activePage="jobs" />

      <section className="jobs-layout" aria-labelledby="jobs-title">
        <div className="jobs-heading">
          <span className="eyebrow">DATA WORKSPACE</span>
          <h1 id="jobs-title">Jobs</h1>
          <p>View the status and details of your submitted jobs.</p>
        </div>

        <section className="jobs-card" aria-label="Job list">
          <div className="jobs-card-heading">
            <h2>All jobs</h2>
            <button
              className="jobs-refresh"
              disabled={isLoading}
              onClick={() => void loadJobs()}
              type="button"
            >
              {isLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {isLoading ? (
            <p className="jobs-message" role="status">
              Loading jobs…
            </p>
          ) : error ? (
            <div className="jobs-message jobs-error" role="alert">
              <p>{error}</p>
              <button
                className="jobs-retry"
                onClick={() => void loadJobs()}
                type="button"
              >
                Try again
              </button>
            </div>
          ) : jobs.length === 0 ? (
            <p className="jobs-message">No jobs found.</p>
          ) : (
            <div className="jobs-table-scroll">
              <table className="jobs-table">
                <thead>
                  <tr>
                    <th scope="col">Status</th>
                    <th scope="col">ID</th>
                    <th scope="col">File name</th>
                    <th scope="col">Error</th>
                    <th scope="col">Created at</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job, index) => (
                    <tr key={`${job.id}-${index}`}>
                      <td>
                        <span className="job-status">{job.status}</span>
                      </td>
                      <td>{job.id}</td>
                      <td>{job.file_name}</td>
                      <td>{job.error || 'None'}</td>
                      <td>{formatCreatedAt(job.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>

      <footer className="page-footer">
        <span>© 2026 Siraj</span>
        <span>Thoughtful work starts here.</span>
      </footer>
    </main>
  )
}

export default JobsPage
