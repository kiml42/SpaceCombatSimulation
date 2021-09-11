using System.Linq;
using UnityEngine;

namespace Assets.Src.Graph
{
    public class ScoreGraphDrawer : BaseGraphDrawer
    {
        internal override void PrepareGraph()
        {
            var generations = ReadGenerations();

            var minScore = new GraphLine(PointTexture, LineTexture) { Colour = Color.red, Name = "Min Score" };
            var avgScore = new GraphLine(PointTexture, LineTexture) { Colour = Color.magenta, Name = "Average Score" };
            var maxScore = new GraphLine(PointTexture, LineTexture) { Colour = Color.green, Name = "Max Score" };

            foreach (var generation in generations)
            {
                minScore.Add(generation.Key, generation.Value.MinScore);
                avgScore.Add(generation.Key, generation.Value.AvgScore);
                maxScore.Add(generation.Key, generation.Value.MaxScore);
            }

            _graph = new LineGraph(GraphRect, BorderTexture, PointTexture, LineTexture, minScore, avgScore, maxScore);
        }
    }
}
