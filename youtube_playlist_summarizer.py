#!/usr/bin/env python3
"""
YouTube Playlist Transcript Summarizer
Fetches recent videos from a playlist, downloads transcripts, and generates summaries in parallel.
"""

import os
import sys
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Optional, List, Dict

from dotenv import load_dotenv
from googleapiclient.discovery import build
from youtube_transcript_api import YouTubeTranscriptApi, TranscriptsDisabled, NoTranscriptFound
from anthropic import Anthropic


@dataclass
class VideoInfo:
    """Information about a YouTube video."""
    video_id: str
    title: str
    published_at: datetime
    channel_title: str


class YouTubePlaylistSummarizer:
    def __init__(self, youtube_api_key: str, anthropic_api_key: str, anthropic_base_url: Optional[str] = None, days_back: int = 7):
        """
        Initialize the summarizer.
        
        Args:
            youtube_api_key: YouTube Data API key
            anthropic_api_key: Anthropic API key for Claude
            anthropic_base_url: Optional base URL for Anthropic API
            days_back: Number of days to look back for recent videos (default: 7)
        """
        self.youtube = build('youtube', 'v3', developerKey=youtube_api_key)
        self.anthropic_client = Anthropic(
            api_key=anthropic_api_key,
            base_url=anthropic_base_url
        )
        self.days_back = days_back
        self.cutoff_date = datetime.now(timezone.utc) - timedelta(days=days_back)

    def get_recent_videos(self, playlist_id: str, max_results: int = 50) -> List[VideoInfo]:
        """Fetch recent videos from a playlist."""
        print(f"Fetching videos from playlist: {playlist_id}")
        recent_videos = []
        next_page_token = None

        while len(recent_videos) < max_results:
            request = self.youtube.playlistItems().list(
                part='snippet,contentDetails',
                playlistId=playlist_id,
                maxResults=min(50, max_results - len(recent_videos)),
                pageToken=next_page_token
            )
            response = request.execute()

            for item in response['items']:
                snippet = item['snippet']
                published_str = snippet['publishedAt'].replace('Z', '+00:00')
                published_at = datetime.fromisoformat(published_str)
                if published_at.tzinfo is None:
                    published_at = published_at.replace(tzinfo=timezone.utc)
                
                # Only include videos published within the date range
                if published_at >= self.cutoff_date:
                    video_info = VideoInfo(
                        video_id=item['contentDetails']['videoId'],
                        title=snippet['title'],
                        published_at=published_at,
                        channel_title=snippet['channelTitle']
                    )
                    recent_videos.append(video_info)

            next_page_token = response.get('nextPageToken')
            if not next_page_token:
                break

        print(f"Found {len(recent_videos)} recent videos (last {self.days_back} days)")
        return recent_videos

    def download_transcript(self, video_id: str) -> Optional[str]:
        """
        Download transcript for a single video.
        Tries auto-generated subtitles first, then falls back to manual subtitles.
        Language priority: English, French, Spanish, German.
        """
        language_priority = ['en', 'fr', 'es', 'de']
        language_names = {'en': 'English', 'fr': 'French', 'es': 'Spanish', 'de': 'German'}

        try:
            ytt_api = YouTubeTranscriptApi()
            transcript_list = ytt_api.list(video_id)

            # Try to find auto-generated transcript first
            try:
                transcript = transcript_list.find_generated_transcript(language_priority)
                transcript_data = transcript.fetch()
                transcript_text = ' '.join([snippet.text for snippet in transcript_data])
                lang_name = language_names.get(transcript.language_code, transcript.language_code)
                print(f"  ✓ Found auto-generated {lang_name} transcript")
                return transcript_text
            except NoTranscriptFound:
                # No auto-generated transcript, try any transcript (manual or auto)
                pass

            # Fall back to any transcript (manual or auto) in preferred languages
            try:
                transcript = transcript_list.find_transcript(language_priority)
                transcript_data = transcript.fetch()
                transcript_text = ' '.join([snippet.text for snippet in transcript_data])
                lang_name = language_names.get(transcript.language_code, transcript.language_code)
                transcript_type = "auto-generated" if transcript.is_generated else "manual"
                print(f"  ✓ Found {transcript_type} {lang_name} transcript")
                return transcript_text
            except NoTranscriptFound:
                print(f"  ⚠️  No transcript available for video {video_id} (tried: {', '.join(language_names.values())})")
                return None

        except (TranscriptsDisabled, NoTranscriptFound) as e:
            print(f"  ⚠️  No transcript available for video {video_id}: {e}")
            return None
        except Exception as e:
            print(f"  ❌ Error downloading transcript for {video_id}: {e}")
            return None

    def get_playlist_title(self, playlist_id: str) -> str:
        """Fetch the playlist title."""
        try:
            request = self.youtube.playlists().list(
                part='snippet',
                id=playlist_id
            )
            response = request.execute()
            if response['items']:
                return response['items'][0]['snippet']['title']
            return "unknown_playlist"
        except Exception as e:
            print(f"Warning: Could not fetch playlist title: {e}")
            return "unknown_playlist"

    def summarize_transcript(self, transcript: str, title: str) -> str:
        """Generate a summary using Claude."""
        prompt = f"""Please provide a comprehensive summary of this YouTube video transcript.
Focus on the main points, key takeaways, and important details.

Video Title: {title}

Transcript:
{transcript}
"""

        try:
            message = self.anthropic_client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2000,
                messages=[{"role": "user", "content": prompt}]
            )
            # Extract text from content blocks
            for block in message.content:
                if hasattr(block, 'text'):
                    return block.text
            return "Error: No text content in response"
        except Exception as e:
            return f"Error generating summary: {e}"

    def process_video(self, video: VideoInfo) -> Dict:
        """Process a single video: download transcript and summarize."""
        print(f"Processing: {video.title}")
        
        # Download transcript
        transcript = self.download_transcript(video.video_id)
        
        if transcript is None:
            return {
                'video': video,
                'transcript': None,
                'summary': 'No transcript available',
                'status': 'failed'
            }
        
        print(f"  ✓ Downloaded transcript ({len(transcript)} chars)")
        
        # Generate summary
        print(f"  Generating summary...")
        summary = self.summarize_transcript(transcript, video.title)
        print(f"  ✓ Summary generated")
        
        return {
            'video': video,
            'transcript': transcript,
            'summary': summary,
            'status': 'success'
        }

    def process_playlist(self, playlist_id: str, max_workers: int = 5) -> List[Dict]:
        """
        Process all recent videos in parallel.
        
        Args:
            playlist_id: YouTube playlist ID
            max_workers: Number of parallel workers (default: 5)
        
        Returns:
            List of results for each video
        """
        # Get recent videos
        videos = self.get_recent_videos(playlist_id)
        
        if not videos:
            print("No recent videos found.")
            return []
        
        print(f"\nProcessing {len(videos)} videos with {max_workers} parallel workers...\n")
        
        # Process videos in parallel
        results = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_video = {executor.submit(self.process_video, video): video 
                             for video in videos}
            
            for future in as_completed(future_to_video):
                try:
                    result = future.result()
                    results.append(result)
                except Exception as e:
                    video = future_to_video[future]
                    print(f"❌ Error processing {video.title}: {e}")
                    results.append({
                        'video': video,
                        'transcript': None,
                        'summary': f'Error: {e}',
                        'status': 'error'
                    })
        
        return results

    def save_results(self, results: List[Dict], playlist_name: str, output_file: Optional[str] = None):
        """Save results to a file."""
        if output_file is None:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M')
            safe_playlist_name = ''.join(c if c.isalnum() or c in (' ', '-', '_') else '_' for c in playlist_name)
            safe_playlist_name = safe_playlist_name.replace(' ', '_')
            output_file = f'{safe_playlist_name}_summaries_{timestamp}.txt'

        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(f"YouTube Playlist Summaries\n")
            f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"{'='*80}\n\n")
            
            for result in results:
                video = result['video']
                f.write(f"Title: {video.title}\n")
                f.write(f"Video ID: {video.video_id}\n")
                f.write(f"Channel: {video.channel_title}\n")
                f.write(f"Published: {video.published_at.strftime('%Y-%m-%d')}\n")
                f.write(f"URL: https://www.youtube.com/watch?v={video.video_id}\n")
                f.write(f"Status: {result['status']}\n\n")
                f.write(f"Summary:\n{result['summary']}\n")
                f.write(f"{'-'*80}\n\n")
        
        print(f"\n✓ Results saved to {output_file}")


def main():
    """Main entry point."""
    load_dotenv()
    # Configuration
    YOUTUBE_API_KEY = os.getenv('YOUTUBE_DATA_API_KEY')
    ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_TOKEN')
    ANTHROPIC_BASE_URL = os.getenv('ANTHROPIC_BASE_URL')
    
    if not YOUTUBE_API_KEY:
        print("Error: YOUTUBE_API_KEY environment variable not set")
        sys.exit(1)
    
    if not ANTHROPIC_API_KEY:
        print("Error: ANTHROPIC_API_KEY environment variable not set")
        sys.exit(1)
    
    # Get playlist ID from command line
    if len(sys.argv) < 2:
        print("Usage: python youtube_playlist_summarizer.py <playlist_id> [days_back] [max_workers]")
        print("\nExample: python youtube_playlist_summarizer.py PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf 7 5")
        sys.exit(1)
    
    playlist_id = sys.argv[1]
    days_back = int(sys.argv[2]) if len(sys.argv) > 2 else 7
    max_workers = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    
    # Initialize summarizer
    summarizer = YouTubePlaylistSummarizer(
        youtube_api_key=YOUTUBE_API_KEY,
        anthropic_api_key=ANTHROPIC_API_KEY,
        anthropic_base_url=ANTHROPIC_BASE_URL,
        days_back=days_back
    )
    
    # Process playlist
    results = summarizer.process_playlist(playlist_id, max_workers=max_workers)

    # Get playlist name for filename
    playlist_name = summarizer.get_playlist_title(playlist_id)

    # Save results
    summarizer.save_results(results, playlist_name)
    
    # Print summary
    successful = sum(1 for r in results if r['status'] == 'success')
    print(f"\n{'='*80}")
    print(f"Processing complete!")
    print(f"Total videos: {len(results)}")
    print(f"Successful: {successful}")
    print(f"Failed: {len(results) - successful}")


if __name__ == '__main__':
    main()
