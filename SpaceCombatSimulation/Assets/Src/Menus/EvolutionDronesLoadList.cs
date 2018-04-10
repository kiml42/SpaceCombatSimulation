using Assets.Src.Database;

namespace Assets.Src.Menus
{
    public class EvolutionDronesLoadList : GenericEvolutionLoadList
    {
        public void Start()
        {
            _handler = new EvolutionDroneDatabaseHandler();
            GenericInitialisation();
        }
    }
}
