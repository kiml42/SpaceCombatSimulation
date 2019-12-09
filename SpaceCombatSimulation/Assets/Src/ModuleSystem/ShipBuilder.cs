using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using Assets.Src.ModuleSystem;
using Assets.Src.ObjectManagement;
using System;
using System.Linq;
using UnityEngine;

namespace Assets.src.Evolution
{
    public class ShipBuilder
    {
        private GenomeWrapper _genome;
        public int GeneLength = 1;

        private readonly ModuleList _moduleList;
        
        private readonly ModuleHub _rootHub;
        private readonly TestCubeChecker _testCubePrefab;
        
        private Color _colour;
        
        public ShipBuilder(GenomeWrapper genomeWrapper, ModuleHub rootHub)
        {
            _rootHub = rootHub;
            if (_rootHub == null)
            {
                throw new ArgumentNullException("shipToBuildOn", "shipToBuildOn must be a valid Transform.");
            }
            _moduleList = _rootHub.ModuleList;
            if(_moduleList == null)
            {
                throw new ArgumentNullException("moduleList", "moduleList must be a valid ModuleList objet.");
            }
            _genome = genomeWrapper;
            _testCubePrefab = _rootHub.TestCube;
        }

        public GenomeWrapper BuildShip(bool setColour = true)
        {
            //Debug.Log("Building " + _genome);
            if (setColour)
            {
                _colour = _genome.GetColorForGenome();
                _rootHub.transform.SetColor(_colour);
            }

            //Debug.Log("Spawning modules on " + _hubToBuildOn.name);

            _genome.UsedLocations.Add(_rootHub.transform.position);
            _genome = SpawnModules();
            
            return _genome;
        }

        [Obsolete("This shouldn't be setable")]
        public void SetGenome(GenomeWrapper genomeWrapper)
        {
            _genome = genomeWrapper;
        }

        private GenomeWrapper SpawnModules()
        {
            var spawnPoints = _rootHub.SpawnPoints;
            var _rootTarget = _rootHub.GetComponent<ITarget>();

            foreach (var spawnPoint in spawnPoints)
            {
                var newUsedLocation = Vector3.zero;
                if (CanSpawnHere(spawnPoint, out newUsedLocation))
                {
                    int? moduleIndex;
                    var moduleToAdd = SelectModule(out moduleIndex);

                    if (moduleToAdd != null)
                    {
                        if(_genome.IsUnderBudget())
                        {
                            //Debug.Log("adding " + moduleToAdd + " total cost = " + _genome.Cost);
                            var addedModule = GameObject.Instantiate(moduleToAdd, spawnPoint.position, spawnPoint.rotation, _rootHub.transform);
                            
                            addedModule.GetComponent<FixedJoint>().connectedBody = _rootHub.GetComponent<Rigidbody>();
                            
                            var hub = addedModule.GetComponent<ModuleHub>();
                            if(hub != null)
                            {
                                hub.AllowedModuleIndicies = _rootHub.AllowedModuleIndicies;
                            }

                            addedModule.GetComponent<ITarget>().SetTeam(_rootTarget.Team);

                            addedModule.transform.SetColor(_colour);
                            addedModule.GetComponent<Rigidbody>().velocity = _rootHub.Velocity;

                            addedModule.transform.SetColor(_colour);

                            _genome.ConfigureAddedModule(addedModule, newUsedLocation, moduleIndex);
                            continue;
                        }
                        //else
                        //{
                        //    Debug.Log("Over budget: cost = " + _genome.Cost + ", budget = " + _genome.Budget);
                        //}
                    }
                    //else
                    //{
                    //    Debug.Log("skipping null module");
                    //}
                }
                //else
                //{
                //    Debug.Log("Can not spawn module here.");
                //}
                _genome.NoModuleAddedHere();
            }
            return _genome;
        }

        /// <summary>
        /// The distance below which two test cubes colliders are considered too close to spawn.
        /// </summary>
        private const float THRESHOLD_DISTANCE = 1;

        private bool CanSpawnHere(Transform spawnPoint, out Vector3 newUsedLocation)
        {
            if (_testCubePrefab != null)
            {
                //Debug.Log("Creating Test Cube");
                var testCube = GameObject.Instantiate(_testCubePrefab, spawnPoint.position, spawnPoint.rotation);
                var collider = testCube.GetComponent<BoxCollider>();
                var center = collider.center;
                newUsedLocation = testCube.transform.TransformPoint(center); //turn it into world coords.
                //collider.bounds.Intersects();//could be useful if the center isn't enough.
                GameObject.Destroy(testCube.gameObject);
                if (IsUsedLocation(newUsedLocation))
                {
                    Debug.Log("Can't spawn at " + center + " because there is already something here");
                    return false;
                }
            }
            else
            {
                newUsedLocation = Vector3.zero; //set to zero if there isn't a test cube - it doesn't matter.
            }
            var canSpawn = _genome.CanSpawn();
            //if (!canSpawn)
            //{
            //    Debug.Log("Can't spawn module because the Genome says so.");
            //}
            return canSpawn;
        }

        private bool IsUsedLocation(Vector3 worldLocation)
        {
            var distances = _genome.UsedLocations.Select(l => Vector3.Distance(l, worldLocation));
            return distances.Any(d => d < THRESHOLD_DISTANCE);
        }

        private ModuleTypeKnower SelectModule(out int? moduleIndex)
        {
            if (_genome.CanSpawn())
            {
                int? number = _genome.GetGeneAsInt();
                if (number.HasValue)
                {
                    var numberInRange = number.Value % _moduleList.Modules.Count();
                    if (_rootHub.AllowedModuleIndicies == null || !_rootHub.AllowedModuleIndicies.Any() || _rootHub.AllowedModuleIndicies.Contains(numberInRange))
                    {
                        //Debug.Log("Adding Module " + number + ": " + Modules[number.Value % _moduleList.Modules.Count()] );
                        moduleIndex = numberInRange;
                        return _moduleList.Modules[numberInRange];
                    }
                    //else
                    //{
                    //    Debug.Log("Not allowed to spawn module " + numberInRange);
                    //}
                }
                //else
                //{
                //    Debug.Log("Failed to parse " + simplified + "as a number");
                //}
            }
            //else
            //{
            //    Debug.Log("Cannot read gene of length " + GeneLength + " at position " + _genomePosition + " in '" + _genome + "'");
            //}
            moduleIndex = null;
            return null;
        }
    }
}

