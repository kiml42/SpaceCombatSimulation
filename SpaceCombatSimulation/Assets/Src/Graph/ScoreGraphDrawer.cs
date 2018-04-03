using System.Linq;
using UnityEngine;

namespace Assets.Src.Graph
{
    public class ScoreGraphDrawer : BaseGraphDrawer
    {
        private LineGraph _graph;

        protected override bool _hasCalculatedGraph
        {
            get
            {
                return _graph != null;
            }
        }

        internal override void DrawGraph()
        {
            if(_graph != null)
            {
                _graph.DrawGraph(GraphRect, BorderTexture, PointTexture);
            }
        }

        internal override void PrepareGraph()
        {
            var generations = Enumerable.Range(0, EvolutionControler.GenerationNumber)
                .ToDictionary(i => i, i => EvolutionControler.DbHandler.ReadBaseGeneration(EvolutionControler.DatabaseId, i));

            var minScore = new GraphLine { Colour = Color.red };
            var avgScore = new GraphLine { Colour = Color.magenta };
            var maxScore = new GraphLine { Colour = Color.green };

            foreach (var generation in generations)
            {
                minScore.Add(generation.Key, generation.Value.MinScore);
                avgScore.Add(generation.Key, generation.Value.AvgScore);
                maxScore.Add(generation.Key, generation.Value.MaxScore);
            }

            _graph = new LineGraph(/*minScore,*/ avgScore, maxScore);
        }
    }
}
