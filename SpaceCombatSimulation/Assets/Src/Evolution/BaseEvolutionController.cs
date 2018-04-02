using Assets.Src.Database;
using Assets.Src.Graph;
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Evolution
{
    public abstract class BaseEvolutionController : MonoBehaviour
    {
        public int DatabaseId;

        public EvolutionShipConfig ShipConfig;
        protected EvolutionMutationWrapper _mutationControl = new EvolutionMutationWrapper();
        protected EvolutionMatchController _matchControl;
        public Texture BorderTexture;
        public Texture PointTexture;

        protected IEnumerable<Transform> ListShips()
        {
            return GameObject.FindGameObjectsWithTag(ShipConfig.SpaceShipTag)
                    .Where(s =>
                        s.transform.parent != null &&
                        s.transform.parent.GetComponent<Rigidbody>() != null
                    ).Select(s => s.transform.parent);
        }

        protected abstract GeneralDatabaseHandler _dBHandler { get; }

        protected abstract BaseEvolutionConfig _baseConfig { get; }
        
        private LineGraph _graph;

        public Rect GraphRect = new Rect(50, 50, 300, 300);

        public void OnGUI()
        {
            if (Input.GetKeyUp(KeyCode.G) && _graph == null)
            {
               PrepareGraph();
            }
            if (_graph != null)
            {
                DrawGraph();
            }
        }

        private void PrepareGraph()
        {
           var _generations = Enumerable.Range(0, _baseConfig.GenerationNumber).ToDictionary(i => i, i => _dBHandler.ReadBaseGeneration(DatabaseId, i));

            var minScore = new GraphLine { Colour = Color.red };
            var avgScore = new GraphLine { Colour = Color.magenta };
            var maxScore = new GraphLine { Colour = Color.green };

            foreach (var generation in _generations)
            {
                minScore.Add(generation.Key, generation.Value.MinScore);
                avgScore.Add(generation.Key, generation.Value.AvgScore);
                maxScore.Add(generation.Key, generation.Value.MaxScore);
            }

            _graph = new LineGraph(/*minScore,*/ avgScore, maxScore);
        }

        private void DrawGraph()
        {
            _graph.DrawGraph(GraphRect, BorderTexture, PointTexture);
        }
    }
}
