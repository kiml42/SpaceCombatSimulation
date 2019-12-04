using System.Linq;

namespace Assets.Src.Graph
{
    public class SpeciesGraphDrawer : BaseGraphDrawer
    {
        internal override void PrepareGraph()
        {
            var generations = ReadGenerations();
            var summaries = generations
                .ToDictionary(
                    i => i.Key,
                    i => i.Value.Summaries.ToList()
                );

            //var speciesOverGens = new Dictionary<int, IDictionary<string,int>>();
            ////var subspeciesOverGens = new Dictionary<int, IDictionary<string,int>>();

            //foreach(var kv in generations)
            //{
            //    var species = kv.Value.GroupBy(s => s.Species).ToDictionary(grp => grp.Key, grp => grp.Count());
            //    //var subspecies = summeries.GroupBy(s => s.Subspecies).ToDictionary(grp => grp.Key, grp => grp.Count());

            //    speciesOverGens[kv.Key] = species;
            //    //subspeciesOverGens[kv.Key] = subspecies;
            //}

            var speciesOverGens = summaries.ToDictionary(
                    keyedGen => keyedGen.Key,
                    keyedGen => keyedGen.Value
                        .Where(s => !string.IsNullOrEmpty(s.Species))
                        .GroupBy(s => s.Species)
                        .ToDictionary(grp => grp.Key, grp => grp.Count())
                );

            _graph = new StackedBarGraph(GraphRect, BorderTexture, PointTexture, LineTexture, speciesOverGens);
        }
    }
}
