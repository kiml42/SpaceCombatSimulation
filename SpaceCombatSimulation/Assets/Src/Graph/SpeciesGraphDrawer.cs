using System.Linq;

namespace Assets.Src.Graph
{
    public class SpeciesGraphDrawer : BaseGraphDrawer
    {
        internal override void PrepareGraph()
        {
            var generations = Enumerable.Range(0, EvolutionControler.GenerationNumber)
                .ToDictionary(i => i, i => EvolutionControler.DbHandler.ReadBaseGeneration(EvolutionControler.DatabaseId, i).Summaries);

            //var speciesOverGens = new Dictionary<int, IDictionary<string,int>>();
            ////var subspeciesOverGens = new Dictionary<int, IDictionary<string,int>>();
            
            //foreach(var kv in generations)
            //{
            //    var species = kv.Value.GroupBy(s => s.Species).ToDictionary(grp => grp.Key, grp => grp.Count());
            //    //var subspecies = summeries.GroupBy(s => s.Subspecies).ToDictionary(grp => grp.Key, grp => grp.Count());

            //    speciesOverGens[kv.Key] = species;
            //    //subspeciesOverGens[kv.Key] = subspecies;
            //}

            var speciesOverGens = generations.ToDictionary(
                    keyedGen => keyedGen.Key,
                    keyedGen => keyedGen.Value
                        .GroupBy(s => s.Species)
                        .ToDictionary(grp => grp.Key, grp => grp.Count())
                );

            _graph = new StackedBarGraph(GraphRect, BorderTexture, PointTexture, LineTexture, speciesOverGens);
        }
    }
}
