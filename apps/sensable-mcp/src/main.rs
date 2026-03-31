mod server;
mod skills;

use rmcp::ServiceExt;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let project_path = std::env::var("SENSABLE_PROJECT_PATH")
        .expect("SENSABLE_PROJECT_PATH environment variable must be set");

    let approval_port = std::env::var("SENSABLE_APPROVAL_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok());

    let server = server::SensableMcpServer::new(project_path, approval_port);
    let service = server.serve(rmcp::transport::io::stdio()).await?;
    service.waiting().await?;
    Ok(())
}
