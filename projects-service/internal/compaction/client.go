package compaction

import (
	"context"
	"fmt"

	pb "projects-service/proto"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// Client wraps the gRPC compaction service connection.
type Client struct {
	conn   *grpc.ClientConn
	client pb.CompactionServiceClient
}

// NewClient dials the compaction service at addr
func NewClient(addr string) (*Client, error) {
	conn, err := grpc.Dial(addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return nil, fmt.Errorf("dial compaction service at %s: %w", addr, err)
	}

	return &Client{
		conn:   conn,
		client: pb.NewCompactionServiceClient(conn),
	}, nil
}

// Close releases the underlying connection.
func (c *Client) Close() error {
	return c.conn.Close()
}

// CompactDocument downloads the update log from downloadURL, compacts it,
// and uploads the result to uploadURL. Both should be presigned URLs.
func (c *Client) CompactDocument(ctx context.Context, downloadURL, uploadURL string) error {
	resp, err := c.client.CompactDocument(ctx, &pb.CompactRequest{
		DownloadUrl: downloadURL,
		UploadUrl:   uploadURL,
	})
	if err != nil {
		return fmt.Errorf("compaction RPC failed: %w", err)
	}
	if !resp.Success {
		return fmt.Errorf("compaction failed: %s", resp.ErrorMessage)
	}
	return nil
}
